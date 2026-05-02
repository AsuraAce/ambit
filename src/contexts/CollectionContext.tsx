import * as React from 'react';
import { createContext, useContext, useEffect, ReactNode } from 'react';
import { Collection, SmartCollection } from '../types';
import { useCollectionStore } from '../stores/collectionStore';

interface CollectionContextType {
    collections: Collection[];
    setCollections: React.Dispatch<React.SetStateAction<Collection[]>>;
    smartCollections: SmartCollection[];
    setSmartCollections: React.Dispatch<React.SetStateAction<SmartCollection[]>>;
    setAllCollections: React.Dispatch<React.SetStateAction<Collection[]>>;
    refreshCollections: (debounced?: boolean) => Promise<void>;
    refreshCollectionThumbnails: (debounced?: boolean) => Promise<void>;
    isLoaded: boolean;
}

const CollectionContext = createContext<CollectionContextType | undefined>(undefined);

export const CollectionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const allCollections = useCollectionStore(s => s.collections);
    const isLoaded = useCollectionStore(s => s.isLoaded);
    const refreshCollections = useCollectionStore(s => s.refreshCollections);
    const refreshCollectionThumbnails = useCollectionStore(s => s.refreshCollectionThumbnails);
    const initialize = useCollectionStore(s => s.initialize);

    useEffect(() => {
        initialize();
    }, [initialize]);

    const collections = allCollections.filter(c => !c.filters);
    const smartCollections = allCollections.filter(c => !!c.filters) as SmartCollection[];

    return (
        <CollectionContext.Provider value={{
            collections,
            setCollections: () => { console.warn('setCollections is deprecated, use store actions'); },
            smartCollections,
            setSmartCollections: () => { console.warn('setSmartCollections is deprecated, use store actions'); },
            setAllCollections: () => { console.warn('setAllCollections is deprecated, use store actions'); },
            refreshCollections,
            refreshCollectionThumbnails,
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
