import * as React from 'react';
import { createContext, useState, useContext, useCallback, useEffect, ReactNode } from 'react';
import { Collection, SmartCollection } from '../types';
import { appRepository } from '../services/repository';
import { getAllCollectionsWithStats, upsertCollection, addImagesToCollection } from '../services/db/collectionRepo';

interface CollectionContextType {
    collections: Collection[];
    setCollections: React.Dispatch<React.SetStateAction<Collection[]>>;
    smartCollections: SmartCollection[]; // Unified, but kept for legacy props
    setSmartCollections: React.Dispatch<React.SetStateAction<SmartCollection[]>>;
    setAllCollections: React.Dispatch<React.SetStateAction<Collection[]>>;
    refreshCollections: () => Promise<void>;
    refreshCollectionThumbnails: () => Promise<void>;
    isLoaded: boolean;
}

const CollectionContext = createContext<CollectionContextType | undefined>(undefined);

export const CollectionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [allCollections, setAllCollections] = useState<Collection[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    const refreshCollections = useCallback(async () => {
        const { getAllCollectionsWithStats } = await import('../services/db/collectionRepo');
        const cols = await getAllCollectionsWithStats();
        setAllCollections(cols);
    }, []);

    const isInitializingRef = React.useRef(false);

    // Initial load & Migration
    useEffect(() => {
        if (isInitializingRef.current) return;
        isInitializingRef.current = true;

        const init = async () => {
            // 1. Try to load from SQLite
            let dbCols = await getAllCollectionsWithStats();

            // 2. Only migrate if DB is EMPTY - if it has any collections (invoke or ambit), skip migration
            const shouldMigrate = dbCols.length === 0;
            console.log(`[Collections] Initial load: ${dbCols.length} total, shouldMigrate: ${shouldMigrate}`);

            if (shouldMigrate) {
                // Check if library.json has any collections to migrate
                const state = await appRepository.load();
                const legacyCols = state.collections || [];
                const legacySmart = state.smartCollections || [];
                const hasLegacyData = legacyCols.length > 0 || legacySmart.length > 0;

                if (hasLegacyData) {
                    console.log(`[Collections] Starting migration from JSON (${legacyCols.length} regular, ${legacySmart.length} smart)...`);

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
                    console.log(`[Collections] Migrated ${dbCols.length} collections.`);
                } else {
                    console.log('[Collections] No legacy data to migrate.');
                }
            }

            setAllCollections(dbCols);
            setIsLoaded(true);
        };
        init();
    }, []);

    const collections = allCollections.filter(c => !c.filters);
    const smartCollections = allCollections.filter(c => !!c.filters) as SmartCollection[];

    return (
        <CollectionContext.Provider value={{
            collections,
            setCollections: () => { }, // No-op, managed by DB now
            smartCollections,
            setSmartCollections: () => { }, // No-op, managed by DB now
            setAllCollections,
            refreshCollections,
            refreshCollectionThumbnails: refreshCollections,
            isLoaded
        }}>
            {children}
        </CollectionContext.Provider>
    );
};

export const useCollections = () => {
    const context = useContext(CollectionContext);
    if (!context) throw new Error('useCollections must be used within CollectionProvider');
    return context;
};
