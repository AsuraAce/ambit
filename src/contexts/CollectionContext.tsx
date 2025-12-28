import * as React from 'react';
import { createContext, useState, useContext, useCallback, useEffect, ReactNode, useRef } from 'react';
import { Collection, SmartCollection } from '../types';
import { convertFileSrc } from '@tauri-apps/api/core';
import { appRepository } from '../services/repository';

interface CollectionContextType {
    collections: Collection[];
    setCollections: React.Dispatch<React.SetStateAction<Collection[]>>;
    smartCollections: SmartCollection[];
    setSmartCollections: React.Dispatch<React.SetStateAction<SmartCollection[]>>;
    refreshCollections: () => Promise<void>;
    refreshCollectionThumbnails: () => Promise<void>;
    isLoaded: boolean;
}

const CollectionContext = createContext<CollectionContextType | undefined>(undefined);

export const CollectionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [collections, setCollections] = useState<Collection[]>([]);
    const [smartCollections, setSmartCollections] = useState<SmartCollection[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);
    const isRefreshingRef = useRef(false);

    const refreshManualCollectionThumbs = async (currentCollections: Collection[]) => {
        if (isRefreshingRef.current) return;
        isRefreshingRef.current = true;
        try {
            const { getCollectionThumbnail } = await import('../services/db/collectionRepo');
            const updates = await Promise.all(currentCollections.map(async (col) => {
                if (col.imageIds && col.imageIds.length > 0 && !col.customThumbnail) {
                    const newThumb = await getCollectionThumbnail(col.imageIds);
                    if (newThumb && newThumb !== col.thumbnail) {
                        const thumbUrl = (newThumb.startsWith('http') || newThumb.startsWith('data:') || newThumb.startsWith('blob:'))
                            ? newThumb
                            : convertFileSrc(newThumb.replace(/\\/g, '/'));
                        return { id: col.id, thumbnail: thumbUrl };
                    }
                }
                return null;
            }));

            const updateMap = new Map(updates.filter(u => u !== null).map(u => [u!.id, u!.thumbnail]));
            if (updateMap.size > 0) {
                setCollections(prev => prev.map(c => {
                    if (updateMap.has(c.id)) {
                        return { ...c, thumbnail: updateMap.get(c.id)! };
                    }
                    return c;
                }));
            }
        } finally {
            isRefreshingRef.current = false;
        }
    };

    const refreshCollections = useCallback(async () => {
        const { hydrateCollections } = await import('../services/db/collectionRepo');
        const boardMap = await hydrateCollections();

        setCollections(prevCols => {
            let hasChange = false;
            const nextCols = prevCols.map(col => {
                const dbData = boardMap[col.id];
                if (dbData) {
                    const countChanged = dbData.count !== (col.count ?? col.imageIds.length);
                    // Only consider it a thumb change if no custom thumbnail is set by the user
                    const thumbChanged = !col.customThumbnail && dbData.thumbnail && dbData.thumbnail !== col.thumbnail;

                    if (countChanged || thumbChanged) {
                        hasChange = true;
                        return {
                            ...col,
                            imageIds: [],
                            count: dbData.count,
                            // Priority: Maintain existing thumbnail if customThumbnail is set, 
                            // otherwise pick up the optimized one from the database
                            thumbnail: (col.customThumbnail && col.thumbnail)
                                ? col.thumbnail
                                : (dbData.thumbnail ? (dbData.thumbnail.startsWith('http') ? dbData.thumbnail : convertFileSrc(dbData.thumbnail.replace(/\\/g, '/'))) : col.thumbnail)
                        };
                    }
                }
                return col;
            });

            if (hasChange) {
                refreshManualCollectionThumbs(nextCols);
                return nextCols;
            } else {
                refreshManualCollectionThumbs(prevCols);
                return prevCols;
            }
        });
    }, []);

    // Initial load
    useEffect(() => {
        const loadCollections = async () => {
            const state = await appRepository.load();
            setCollections(state.collections || []);
            setSmartCollections(state.smartCollections || []);
            setIsLoaded(true);

            setTimeout(() => refreshCollections(), 100);
        };
        loadCollections();
    }, [refreshCollections]);

    // Save persistence
    useEffect(() => {
        if (!isLoaded) return;
        const timeout = setTimeout(async () => {
            const state = await appRepository.load();
            await appRepository.save({
                ...state,
                collections,
                smartCollections
            });
        }, 1000);
        return () => clearTimeout(timeout);
    }, [collections, smartCollections, isLoaded]);

    return (
        <CollectionContext.Provider value={{
            collections,
            setCollections,
            smartCollections,
            setSmartCollections,
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
