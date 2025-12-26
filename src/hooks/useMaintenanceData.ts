import { useState, useCallback, useEffect } from 'react';
import { AIImage } from '../types';
import { useLibraryContext } from './useLibraryContext';

export type MaintenanceTab = 'duplicates' | 'trash' | 'missing' | 'untagged' | 'thumbnails';

export const useMaintenanceData = (activeTab: MaintenanceTab, thumbnailsScope: 'global' | 'filtered') => {
    const {
        refreshMaintenanceCounts,
        activeSqlWhere,
        activeSqlParams
    } = useLibraryContext();

    const [isLoading, setIsLoading] = useState(false);
    const [initializedTabs, setInitializedTabs] = useState<Set<string>>(new Set());

    const [localDeletedImages, setLocalDeletedImages] = useState<AIImage[]>([]);
    const [localUntaggedImages, setLocalUntaggedImages] = useState<AIImage[]>([]);
    const [localUnoptimizedImages, setLocalUnoptimizedImages] = useState<AIImage[]>([]);
    const [localDuplicateCandidates, setLocalDuplicateCandidates] = useState<AIImage[]>([]);

    const refreshData = useCallback(async (tab: MaintenanceTab, showLoader: boolean = true, options: { scope?: 'global' | 'filtered' } = {}) => {
        if (showLoader) setIsLoading(true);
        try {
            const db = await import('../services/db');

            // Always refresh counts in background
            refreshMaintenanceCounts();

            if (tab === 'trash') {
                const data = await db.getDeletedImages();
                setLocalDeletedImages(data);
            } else if (tab === 'untagged') {
                const data = await db.getUntaggedImages();
                setLocalUntaggedImages(data);
            } else if (tab === 'thumbnails') {
                const where = options.scope === 'filtered' ? activeSqlWhere : '';
                const params = options.scope === 'filtered' ? activeSqlParams : [];
                const data = await db.getUnoptimizedImages(where, params);
                setLocalUnoptimizedImages(data);
            } else if (tab === 'duplicates') {
                const where = options.scope === 'filtered' ? activeSqlWhere : '';
                const params = options.scope === 'filtered' ? activeSqlParams : [];
                const data = await db.getDuplicateCandidates(where, params);
                setLocalDuplicateCandidates(data);
            }

            setInitializedTabs(prev => new Set(prev).add(tab));
        } catch (e) {
            console.error("Failed to refresh maintenance data", e);
        } finally {
            if (showLoader) setIsLoading(false);
        }
    }, [refreshMaintenanceCounts, activeSqlWhere, activeSqlParams]);

    useEffect(() => {
        // ONLY auto-trigger for trash. Everything else requires manual 'Start Scan'.
        if (activeTab === 'trash' && !initializedTabs.has('trash')) {
            refreshData('trash', true);
        }
    }, [activeTab, refreshData, initializedTabs]);

    return {
        isLoading,
        initializedTabs, // Export this so the UI knows if a tab has been scanned
        localDeletedImages,
        localUntaggedImages,
        localUnoptimizedImages,
        localDuplicateCandidates,
        refreshData,
        setLocalDeletedImages,
        setLocalUntaggedImages,
        setLocalUnoptimizedImages,
        setLocalDuplicateCandidates
    };
};
